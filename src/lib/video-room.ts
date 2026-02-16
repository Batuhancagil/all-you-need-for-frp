export function buildVideoRoomName(roomId: string) {
  const safeRoomId = roomId.replace(/[^a-zA-Z0-9]/g, "");
  return `AllYouNeedForFRP${safeRoomId || "Room"}`;
}

export function buildVideoChannelRoomName(roomId: string, channelSlug: string) {
  const safeRoomId = roomId.replace(/[^a-zA-Z0-9]/g, "");
  const safeChannelSlug = channelSlug.replace(/[^a-zA-Z0-9]/g, "");
  return `AllYouNeedForFRP${safeRoomId || "Room"}${safeChannelSlug || "Voice"}`;
}
