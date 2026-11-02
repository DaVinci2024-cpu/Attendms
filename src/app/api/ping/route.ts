// Health-check endpoint for electron/main.cjs's startup poll: it loads the
// renderer window only once this responds, so a slow first boot (cold
// Node start) never shows a blank/error page instead of a loading state.
export async function GET() {
  return Response.json({ status: "pong", time: new Date().toISOString() });
}
