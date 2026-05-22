import React from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, Hammer, Map, ArrowRight } from "lucide-react";

/**
 * "Why We Exist" homepage section. Frames the value proposition against
 * the unspoken comparison every buyer already makes ("but I could just
 * use Etsy/Amazon"). Written in plain language, no hyperbole — the
 * authenticity itself is the message.
 *
 * Mounted between `<VelocityProofStrip>` and `<ShopOfTheWeek>` on `/`.
 */
export default function WhyWeExist({ testId = "why-we-exist" }) {
  const pillars = [
    {
      icon: <ShieldCheck size={18} />,
      title: "Vetted American makers.",
      body:
        "Every seller on Crafters Market is a real person working in a real workshop — application-vetted, location-verified, and reachable directly. No dropshipping. No reseller listings. No factory storefronts pretending to be artisans.",
    },
    {
      icon: <Hammer size={18} />,
      title: "Built to order. Not warehoused.",
      body:
        "Most pieces here are cut, welded, carved, or engraved after you place the order. You're commissioning the work, not buying inventory. That's why the maker can match your size, finish, material, and message — without surcharges.",
    },
    {
      icon: <Map size={18} />,
      title: "Made in real shops across America.",
      body:
        "From a CNC garage in Washington to a welding bay in Texas to a wood studio in Vermont — every order ships from the maker's own workshop. Tracking shows you exactly where it came from.",
    },
  ];

  return (
    <section
      className="w-full max-w-[1800px] mx-auto px-4 md:px-8 xl:px-12 py-14 md:py-20"
      data-testid={testId}
    >
      <div className="grid md:grid-cols-[1fr_2fr] gap-8 md:gap-14 items-start">
        <header>
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-[#ff4500]">
            ◆ Why we exist
          </p>
          <h2 className="font-display text-4xl md:text-5xl text-[#e5e5e5] mt-3 leading-[0.95]">
            Big marketplaces broke handmade.<br />
            <span className="text-[#ff4500]">We're rebuilding it.</span>
          </h2>
          <p className="font-mono text-xs md:text-sm text-[#a3a3a3] mt-5 leading-relaxed">
            Etsy and Amazon flooded the "handmade" aisle with factory imports and
            drop-shipped knock-offs. Crafters Market exists so American artists,
            welders, woodworkers, and CNC creators can sell direct — and so buyers
            can find the real thing again.
          </p>
        </header>

        <ul className="space-y-6 md:space-y-7">
          {pillars.map((p) => (
            <li
              key={p.title}
              className="border-l-2 border-[#ff4500] pl-5 md:pl-6"
              data-testid={`${testId}-pillar`}
            >
              <div className="flex items-center gap-2 text-[#ff4500] mb-1.5">
                {p.icon}
                <h3 className="font-display text-lg md:text-xl uppercase text-[#e5e5e5]">
                  {p.title}
                </h3>
              </div>
              <p className="font-mono text-xs md:text-sm text-[#a3a3a3] leading-relaxed">
                {p.body}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap gap-3 mt-10 md:mt-12">
        <Link
          to="/about"
          className="inline-flex items-center gap-2 px-5 py-2.5 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] transition"
          data-testid={`${testId}-about-link`}
        >
          Read the full story <ArrowRight size={12} />
        </Link>
        <Link
          to="/beta"
          className="inline-flex items-center gap-2 px-5 py-2.5 border border-[#262626] hover:border-[#ff4500] hover:text-[#ff4500] font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] transition"
          data-testid={`${testId}-apply-link`}
        >
          Are you a maker? Apply <ArrowRight size={12} />
        </Link>
      </div>
    </section>
  );
}
