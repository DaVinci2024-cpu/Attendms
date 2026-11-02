import { db, isFirebaseConfigured, getConfiguredProjectId } from "@/lib/server/firebaseAdmin";

export async function GET() {
  if (!isFirebaseConfigured()) {
    return Response.json({
      status: "not_configured",
      dbConnected: false,
      message: "This install hasn't connected a Firebase project yet — see System > Cloud Sync.",
    });
  }

  try {
    const healthDoc = db.collection("health").doc("status");
    await healthDoc.set(
      { last_check: new Date().toISOString(), server_uptime: process.uptime() },
      { merge: true }
    );
    return Response.json({ status: "ok", dbConnected: true, projectId: getConfiguredProjectId() });
  } catch (err) {
    return Response.json({
      status: "error",
      dbConnected: false,
      message: err instanceof Error ? err.message : "Firestore connection failed",
    });
  }
}
