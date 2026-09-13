import { createFileRoute } from "@tanstack/react-router";
import { CityLanding } from "@/components/city/CityLanding";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Newintel · Find the demand before it becomes the order" },
      {
        name: "description",
        content:
          "Event-driven demand intelligence. Describe what you sell, Newintel investigates the companies drifting toward a purchase like yours, then states the verdict and the window.",
      },
    ],
  }),
  component: CityLanding,
});
