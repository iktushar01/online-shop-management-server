import { StatusCodes } from "http-status-codes";
import { Role } from "../../lib/prisma-exports";
import AppError from "../../errorHelpers/AppError";
import { prisma } from "../../lib/prisma";
import { IRequestUser } from "../auth/auth.interface";

const adminPublicSelect = {
    id: true,
    name: true,
    email: true,
    image: true,
    isActive: true,
    deletedAt: true,
    createdAt: true,
    updatedAt: true,
} as const;

const getAllAdmins = async (requestingUser: IRequestUser) => {
    const admins = await prisma.user.findMany({
        where: {
            role: Role.ADMIN,
            deletedAt: null,
        },
        select: adminPublicSelect,
        orderBy: {
            createdAt: "desc",
        },
    });

    return admins;
};

const getDashboardStats = async (requestingUser: IRequestUser) => {
    if (requestingUser.role !== Role.ADMIN) {
        throw new AppError(
            StatusCodes.FORBIDDEN,
            "Only Admin can access dashboard stats",
        );
    }

    const [
        totalAdmins,
        totalCustomers,
        totalProducts,
        totalCategories,
        totalOrders,
        totalReviews,
        recentOrders,
    ] = await Promise.all([
        prisma.user.count({
            where: { role: Role.ADMIN, deletedAt: null },
        }),
        prisma.user.count({
            where: { role: Role.CUSTOMER, deletedAt: null },
        }),
        prisma.product.count(),
        prisma.category.count(),
        prisma.order.count(),
        prisma.review.count(),
        prisma.order.findMany({
            take: 5,
            orderBy: { createdAt: "desc" },
            include: {
                user: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    }
                }
            }
        }),
    ]);

    return {
        adminSummary: {
            totalAdmins,
            totalCustomers,
        },
        contentSummary: {
            products: totalProducts,
            categories: totalCategories,
            orders: totalOrders,
            reviews: totalReviews,
        },
        recentOrders,
    };
};

const getAdminById = async (id: string, requestingUser: IRequestUser) => {
    const admin = await prisma.user.findFirst({
        where: {
            id,
            role: Role.ADMIN,
            deletedAt: null,
        },
        select: adminPublicSelect,
    });

    if (!admin) {
        throw new AppError(StatusCodes.NOT_FOUND, "Admin not found");
    }

    return admin;
};

const updateAdmin = async (
    id: string,
    payload: any,
    requestingUser: IRequestUser,
) => {
    const adminRecord = await prisma.user.findFirst({
        where: { id, role: Role.ADMIN, deletedAt: null }
    });

    if (!adminRecord) {
        throw new AppError(StatusCodes.NOT_FOUND, "Admin not found");
    }

    const { admin } = payload;

    if (!admin || Object.keys(admin).length === 0) {
        throw new AppError(StatusCodes.BAD_REQUEST, "No admin fields provided for update");
    }

    const updateData: any = {};
    if (admin.name !== undefined) {
        updateData.name = admin.name;
    }
    if (admin.profilePhoto !== undefined) {
        updateData.image = admin.profilePhoto;
    }

    const updatedAdmin = await prisma.user.update({
        where: {
            id,
        },
        data: updateData,
        select: adminPublicSelect,
    });

    return updatedAdmin;
};

const deleteAdmin = async (id: string, requestingUser: IRequestUser) => {
    const adminRecord = await prisma.user.findFirst({
        where: { id, role: Role.ADMIN, deletedAt: null }
    });

    if (!adminRecord) {
        throw new AppError(StatusCodes.NOT_FOUND, "Admin not found");
    }

    if (adminRecord.id === requestingUser.userId) {
        throw new AppError(StatusCodes.BAD_REQUEST, "You cannot delete yourself");
    }

    const result = await prisma.$transaction(async (tx: any) => {
        const deleted = await tx.user.update({
            where: { id },
            data: {
                deletedAt: new Date(),
                isActive: false,
            },
            select: adminPublicSelect,
        });

        await tx.session.deleteMany({
            where: { userId: id },
        });

        await tx.account.deleteMany({
            where: { userId: id },
        });

        return deleted;
    });

    return result;
};

export const AdminService = {
    getDashboardStats,
    getAllAdmins,
    getAdminById,
    updateAdmin,
    deleteAdmin,
};
