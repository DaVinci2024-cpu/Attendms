import { getLanSelfInfo } from "@/lib/server/lanDiscovery";

export async function GET() {
  return Response.json(getLanSelfInfo());
}
