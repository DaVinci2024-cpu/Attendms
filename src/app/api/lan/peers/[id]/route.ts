import { removePeer } from "@/lib/server/lanDiscovery";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const removed = removePeer(id);
  return Response.json({ success: removed });
}
