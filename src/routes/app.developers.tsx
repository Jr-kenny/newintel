import { createFileRoute, redirect } from "@tanstack/react-router";

/** Developer contract lives on the public chapter, not in the business workspace. */
export const Route = createFileRoute("/app/developers")({
  beforeLoad: () => {
    throw redirect({ to: "/developers" });
  },
});
