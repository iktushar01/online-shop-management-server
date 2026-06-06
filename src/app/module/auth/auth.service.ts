import type { Prisma } from "../../../generated/prisma/index";
import { Prisma as PrismaValue, Role, UserStatus } from "../../lib/prisma-exports";
import AppError from "../../errorHelpers/AppError";
import { auth } from "../../lib/auth";
import { prisma } from "../../lib/prisma";
import { StatusCodes } from "http-status-codes";
import { tokenUtils } from "../../utils/token";
import { jwtUtils } from "../../utils/jwt";
import { envVars } from "../../../config/env";
import { uploadFileToCloudinary, deleteFileFromCloudinary } from "../../../config/cloudinary.config";
import {
    IChangePassWordPayload,
    ILoginUser,
    IRegisterStudent,
    IRequestUser,
    IUpdateProfilePayload,
} from "./auth.interface";


// ─── Helpers ─────────────────────────────────────────────────────────────────

const buildTokenPair = (user: {
    id: string;
    role: Role;
    name: string;
    email: string;
    status: UserStatus;
    isDeleted: boolean;
    emailVerified: boolean;
}) => {
    const payload = {
        userId: user.id,
        role: user.role,
        name: user.name,
        email: user.email,
        status: user.status,
        isDeleted: user.isDeleted,
        emailVerified: user.emailVerified,
    };
    return {
        accessToken: tokenUtils.getAccessToken(payload),
        refreshToken: tokenUtils.getRefreshToken(payload),
    };
};

// ─── Register ─────────────────────────────────────────────────────────────────

const registerStudent = async (payload: IRegisterStudent, fileBuffer?: Buffer, fileName?: string) => {
    const { name, email, password } = payload;

    const uploadPromise = fileBuffer && fileName
        ? uploadFileToCloudinary(fileBuffer, fileName)
            .then(res => res.secure_url)
            .catch(() => {
                throw new AppError(StatusCodes.BAD_REQUEST, "Failed to upload image. Please try again.");
            })
        : Promise.resolve(undefined);

    const signUpPromise = auth.api.signUpEmail({
        body: { 
            name, 
            email, 
            password,
            role: Role.CUSTOMER
        },
    });

    let imageUrl: string | undefined;
    let authData;
    
    try {
        [imageUrl, authData] = await Promise.all([uploadPromise, signUpPromise]);
    } catch (error: any) {
        if (error?.message?.toLowerCase().includes("exist") || error?.status === 409) {
            throw new AppError(StatusCodes.CONFLICT, "A user with this email already exists");
        }
        throw error;
    }

    if (!authData?.user) {
        if (imageUrl) {
            await deleteFileFromCloudinary(imageUrl, "image").catch(() => {});
        }
        throw new AppError(StatusCodes.BAD_REQUEST, "User registration failed");
    }

    try {
        if (imageUrl) {
            await prisma.user.update({
                where: { id: authData.user.id },
                data: { image: imageUrl },
            });
            authData.user.image = imageUrl;
        }

        const { accessToken, refreshToken } = buildTokenPair({
            id: authData.user.id,
            role: authData.user.role as Role,
            name: authData.user.name,
            email: authData.user.email,
            status: UserStatus.ACTIVE,
            isDeleted: false,
            emailVerified: authData.user.emailVerified,
        });

        return {
            user: authData.user,
            token: authData.token,
            accessToken,
            refreshToken,
        };
    } catch (error: any) {
        try {
            if (imageUrl) {
                await deleteFileFromCloudinary(imageUrl, "image");
            }
            await prisma.user.delete({ where: { id: authData.user.id } });
        } catch (rollbackErr) {
            console.error("Rollback failed for user:", authData.user.id, rollbackErr);
        }

        if (
            error instanceof PrismaValue.PrismaClientKnownRequestError &&
            error.code === "P2002"
        ) {
            throw new AppError(
                StatusCodes.CONFLICT,
                "This email is already registered. Please log in or use a different email."
            );
        }

        throw error;
    }
};

// ─── Login ────────────────────────────────────────────────────────────────────

const loginUser = async (payload: ILoginUser) => {
    const { email, password } = payload;

    const dbUser = await prisma.user.findUnique({ where: { email } });

    if (!dbUser) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "Invalid email or password");
    }

    if (dbUser.deletedAt !== null) {
        throw new AppError(StatusCodes.FORBIDDEN, "This account has been deleted");
    }

    if (!dbUser.isActive) {
        throw new AppError(StatusCodes.FORBIDDEN, "This account has been suspended");
    }

    const authData = await auth.api.signInEmail({ body: { email, password } });

    const { accessToken, refreshToken } = buildTokenPair({
        id: authData.user.id,
        role: authData.user.role as Role,
        name: authData.user.name,
        email: authData.user.email,
        status: UserStatus.ACTIVE,
        isDeleted: false,
        emailVerified: authData.user.emailVerified,
    });

    return {
        user: authData.user,
        token: authData.token,
        accessToken,
        refreshToken,
    };
};

// ─── Get Me ───────────────────────────────────────────────────────────────────

const fetchCurrentUserById = async (userId: string) => {
    const dbUser = await prisma.user.findUnique({
        where: { id: userId }
    });

    if (!dbUser) {
        throw new AppError(StatusCodes.NOT_FOUND, "User not found");
    }

    return dbUser;
};

const getMe = async (user: IRequestUser) => {
    return fetchCurrentUserById(user.userId);
};

const updateProfile = async (payload: IUpdateProfilePayload) => {
    const {
        userId,
        name,
        profilePhoto,
        fileBuffer,
        fileName,
    } = payload;

    const dbUser = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            role: true,
        },
    });

    if (!dbUser) {
        throw new AppError(StatusCodes.NOT_FOUND, "User not found");
    }

    const uploadedProfilePhoto =
        fileBuffer && fileName
            ? await uploadFileToCloudinary(fileBuffer, fileName).then((result) => result.secure_url)
            : undefined;

    const finalProfilePhoto =
        uploadedProfilePhoto !== undefined ? uploadedProfilePhoto : profilePhoto;

    const userUpdateData: Prisma.UserUpdateInput = {};

    if (name !== undefined) {
        userUpdateData.name = name;
    }

    if (finalProfilePhoto !== undefined) {
        userUpdateData.image = finalProfilePhoto;
    }

    if (Object.keys(userUpdateData).length > 0) {
        await prisma.user.update({
            where: { id: userId },
            data: userUpdateData,
        });
    }

    return fetchCurrentUserById(userId);
};

// ─── Refresh tokens ───────────────────────────────────────────────────────────

const getNewTokens = async (oldRefreshToken: string, sessionToken?: string) => {
    const verified = jwtUtils.verifyToken(oldRefreshToken, envVars.REFRESH_TOKEN_SECRET);

    if (!verified.success || !verified.decoded) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "Invalid refresh token");
    }

    const { decoded } = verified;

    const { accessToken, refreshToken: newRefreshToken } = buildTokenPair({
        id: decoded.userId,
        role: decoded.role,
        name: decoded.name,
        email: decoded.email,
        status: decoded.status,
        isDeleted: decoded.isDeleted,
        emailVerified: decoded.emailVerified,
    });

    if (sessionToken) {
        const session = await prisma.session.findUnique({
            where: { token: sessionToken },
            include: { user: true },
        });

        if (session) {
            await prisma.session.update({
                where: { token: sessionToken },
                data: {
                    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                    updatedAt: new Date(),
                },
            });
        }
    }

    return {
        accessToken,
        refreshToken: newRefreshToken,
    };
};

// ─── Change Password ──────────────────────────────────────────────────────────

const changePassword = async (
    payload: IChangePassWordPayload,
    sessionToken: string,
) => {
    const session = await auth.api.getSession({
        headers: new Headers({ Authorization: `Bearer ${sessionToken}` }),
    });

    if (!session?.user) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "Invalid or expired session");
    }

    const { currentPassword, newPassword } = payload;

    await auth.api.changePassword({
        body: { currentPassword, newPassword, revokeOtherSessions: true },
        headers: new Headers({ Authorization: `Bearer ${sessionToken}` }),
    });

    const { accessToken, refreshToken } = buildTokenPair({
        id: session.user.id,
        role: session.user.role as Role,
        name: session.user.name,
        email: session.user.email,
        status: UserStatus.ACTIVE,
        isDeleted: false,
        emailVerified: session.user.emailVerified,
    });

    return { accessToken, refreshToken };
};

// ─── Logout ───────────────────────────────────────────────────────────────────

const logoutUser = async (sessionToken: string) => {
    if (!sessionToken) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "No active session");
    }

    return auth.api.signOut({
        headers: new Headers({ Authorization: `Bearer ${sessionToken}` }),
    });
};

// ─── Email verification ───────────────────────────────────────────────────────

const verifyEmail = async (email: string, otp: string) => {
    const result = await auth.api.verifyEmailOTP({ body: { email, otp } });

    if (result?.status && !result.user?.emailVerified) {
        await prisma.user.update({
            where: { email },
            data: { emailVerified: true },
        });
    }
};

// ─── Forget / Reset password ──────────────────────────────────────────────────

const forgetPassword = async (email: string) => {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || user.deletedAt !== null || !user.isActive) {
        return;
    }

    if (!user.emailVerified) {
        throw new AppError(StatusCodes.BAD_REQUEST, "Please verify your email first");
    }

    await auth.api.requestPasswordResetEmailOTP({ body: { email } });
};

const resetPassword = async (
    email: string,
    otp: string,
    newPassword: string,
) => {
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || user.deletedAt !== null || !user.isActive) {
        throw new AppError(StatusCodes.NOT_FOUND, "User not found");
    }

    if (!user.emailVerified) {
        throw new AppError(StatusCodes.BAD_REQUEST, "Please verify your email first");
    }

    await auth.api.resetPasswordEmailOTP({
        body: { email, otp, password: newPassword },
    });

    await prisma.session.deleteMany({ where: { userId: user.id } });
};

// ─── Google OAuth ─────────────────────────────────────────────────────────────

const googleLoginSuccess = async (session: {
    user: {
        id: string;
        name: string;
        email: string;
        role: string;
        emailVerified: boolean;
        image?: string | null | undefined;
    };
}) => {
    const { user } = session;

    const { accessToken, refreshToken } = buildTokenPair({
        id: user.id,
        role: user.role as Role,
        name: user.name,
        email: user.email,
        status: UserStatus.ACTIVE,
        isDeleted: false,
        emailVerified: user.emailVerified,
    });

    return { accessToken, refreshToken, user };
};

const issueTokensFromOAuthCode = async (user: {
    id: string;
    name: string;
    email: string;
    role: string;
    emailVerified: boolean;
    image?: string | null | undefined;
}) => {
    const { accessToken, refreshToken } = buildTokenPair({
        id: user.id,
        role: user.role as Role,
        name: user.name,
        email: user.email,
        status: UserStatus.ACTIVE,
        isDeleted: false,
        emailVerified: user.emailVerified,
    });

    return { accessToken, refreshToken, user };
};

// ─── Exports ──────────────────────────────────────────────────────────────────

export const AuthService = {
    registerStudent,
    loginUser,
    getMe,
    updateProfile,
    getNewTokens,
    changePassword,
    logoutUser,
    verifyEmail,
    forgetPassword,
    resetPassword,
    googleLoginSuccess,
    issueTokensFromOAuthCode,
};
