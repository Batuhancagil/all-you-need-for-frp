export function buildVideoRoomName(roomId: string) {
  const safeRoomId = roomId.replace(/[^a-zA-Z0-9]/g, "");
  return `AllYouNeedForFRP${safeRoomId || "Room"}`;
}
