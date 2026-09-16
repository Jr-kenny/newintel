import { createFileRoute, redirect } from "@tanstack/react-router";

/** Agent roster is part of the public developer chapter. */
export const Route = createFileRoute("/app/agents")({
  beforeLoad: () => {
    throw redirect({ to: "/developers" });
  },
});
