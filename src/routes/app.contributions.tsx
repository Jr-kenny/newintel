import { createFileRoute, redirect } from "@tanstack/react-router";

/** Settlement model is explained on the public developer chapter. */
export const Route = createFileRoute("/app/contributions")({
  beforeLoad: () => {
    throw redirect({ to: "/developers" });
  },
});
