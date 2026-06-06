import prismaPkg from "../../generated/prisma/index";

const prismaModule = prismaPkg as any;

export const PrismaClient = prismaModule.PrismaClient;
export const Prisma = prismaModule.Prisma;

export const Role = {
  ADMIN: "ADMIN" as const,
  SUPER_ADMIN: "ADMIN" as const, // Map SUPER_ADMIN to ADMIN
  CUSTOMER: "CUSTOMER" as const,
  STUDENT: "CUSTOMER" as const,  // Map STUDENT to CUSTOMER
};
export type Role = (typeof Role)[keyof typeof Role];

export const UserStatus = {
  ACTIVE: "ACTIVE" as const,
  SUSPENDED: "SUSPENDED" as const,
  DELETED: "DELETED" as const,
};
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const Gender = {
  MALE: "MALE" as const,
  FEMALE: "FEMALE" as const,
  OTHER: "OTHER" as const,
};
export type Gender = (typeof Gender)[keyof typeof Gender];

export const ClassroomStatus = {
  PENDING: "PENDING" as const,
  APPROVED: "APPROVED" as const,
  REJECTED: "REJECTED" as const,
};
export type ClassroomStatus =
  (typeof ClassroomStatus)[keyof typeof ClassroomStatus];

export const MembershipRole = {
  ADMIN: "ADMIN" as const,
  MEMBER: "MEMBER" as const,
};
export type MembershipRole =
  (typeof MembershipRole)[keyof typeof MembershipRole];

export const NoteStatus = {
  PENDING: "PENDING" as const,
  APPROVED: "APPROVED" as const,
  REJECTED: "REJECTED" as const,
};
export type NoteStatus = (typeof NoteStatus)[keyof typeof NoteStatus];

export const InstitutionLevel = {
  SCHOOL: "SCHOOL" as const,
  COLLEGE: "COLLEGE" as const,
  UNIVERSITY: "UNIVERSITY" as const,
};
export type InstitutionLevel =
  (typeof InstitutionLevel)[keyof typeof InstitutionLevel];

