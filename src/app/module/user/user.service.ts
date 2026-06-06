import { Role } from "../../lib/prisma-exports";
import AppError from "../../errorHelpers/AppError";
import { auth } from "../../lib/auth";
import { prisma } from "../../lib/prisma";
import { StatusCodes } from "http-status-codes";
import {
    ICreateAdminPayload,
} from "./user.interface";

// ─── Shared select shapes ─────────────────────────────────────────────────────

const userPublicSelect = {
    id: true,
    email: true,
    name: true,
    role: true,
    isActive: true,
    emailVerified: true,
    image: true,
    deletedAt: true,
    createdAt: true,
    updatedAt: true,
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const assertEmailNotTaken = async (email: string) => {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
        throw new AppError(
            StatusCodes.CONFLICT,
            "A user with this email already exists",
        );
    }
};

// ─── Admin ────────────────────────────────────────────────────────────────────

/**
 * Creates an ADMIN or SUPER_ADMIN account.
 *
 * The first SUPER_ADMIN is created via the seed script — this endpoint is
 * for subsequent admin/super-admin provisioning by an already-authenticated admin.
 *
 * Role elevation rules:
 *  - SUPER_ADMIN can create ADMIN or SUPER_ADMIN
 *  - ADMIN can only create ADMIN
 */
const createAdmin = async (
    payload: ICreateAdminPayload,
    requestingUserRole: Role,
) => {
    if (
        payload.role === Role.SUPER_ADMIN &&
        requestingUserRole !== Role.SUPER_ADMIN
    ) {
        throw new AppError(
            StatusCodes.FORBIDDEN,
            "Only a Super Admin can create another Super Admin",
        );
    }

    await assertEmailNotTaken(payload.admin.email);

    const { user: authUser } = await auth.api.signUpEmail({
        body: {
            name: payload.admin.name,
            email: payload.admin.email,
            password: payload.password,
            role: payload.role,
        },
    });

    return authUser;
};

// ─── Exports ──────────────────────────────────────────────────────────────────

export const UserService = {
    createAdmin
};
