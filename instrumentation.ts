export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureSchedulerStarted } = await import("./lib/scheduler");
    await ensureSchedulerStarted();
  }
}
