-- AlterTable
ALTER TABLE "InitiativeEntry" ADD COLUMN "results" INTEGER[] DEFAULT ARRAY[]::INTEGER[];
