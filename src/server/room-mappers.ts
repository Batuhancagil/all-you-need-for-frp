import { ParticipantRole, RoomPrivacy, SessionState } from "@prisma/client";

export function mapPrivacy(privacy: RoomPrivacy) {
  return privacy === "PUBLIC" ? "public" : "private";
}

export function mapSessionState(state: SessionState) {
  if (state === "ACTIVE") return "active";
  if (state === "ENDED") return "ended";
  return "waiting";
}

export function mapParticipantRole(role: ParticipantRole) {
  if (role === "ADMIN") return "admin";
  if (role === "GM") return "gm";
  return "player";
}
