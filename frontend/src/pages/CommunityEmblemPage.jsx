// iter413bs — Dedicated /community/emblem landing page.
// Hosts the interactive variant of the Garage Builders v2 emblem so we
// can test discovery engagement before expanding hotspots to the home
// page hero. Same component, opt-in via the `interactive` prop.

import React, { useEffect } from "react";
import CommunityEmblem from "../components/CNCEmblem";

export default function CommunityEmblemPage() {
  useEffect(() => {
    const prev = document.title;
    document.title = "Garage Builders Emblem — All Makers. One Community.";
    return () => { document.title = prev; };
  }, []);

  return (
    <main data-testid="community-emblem-page">
      <header className="bg-paper border-b border-line py-10 md:py-14">
        <div className="max-w-[1400px] mx-auto px-4 md:px-8">
          <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-brand mb-3">
            ◆ Community Emblem · v2
          </div>
          <h1 className="font-display text-4xl md:text-6xl uppercase leading-[0.95] max-w-3xl">
            The badge is now a map.
          </h1>
          <p className="font-mono text-base text-ink-muted mt-4 max-w-2xl leading-relaxed">
            Hover any maker segment to highlight it. Click to filter the shop down to that craft.
            Same badge, doubled as a way to find the makers you already identify with.
          </p>
        </div>
      </header>
      <CommunityEmblem interactive />
    </main>
  );
}
