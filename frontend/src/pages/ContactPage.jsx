import React from "react";
import { Mail, MapPin, Instagram } from "lucide-react";

export default function ContactPage() {
  return (
    <div className="pt-32 pb-24 grain min-h-screen" data-testid="contact-page">
      <div className="max-w-[1100px] mx-auto px-4 md:px-8">
        <div className="font-mono text-[11px] uppercase tracking-[0.3em] text-[#ff4500] mb-4">
          ◆ Get in Touch
        </div>
        <h1 className="font-display text-[56px] md:text-[100px] leading-[0.88] uppercase mb-12">
          Contact <span className="text-outline-orange">Us.</span>
        </h1>

        <div className="grid md:grid-cols-2 gap-10">
          <div className="space-y-6">
            <Block icon={<Mail />} title="Email" value="team@craftersmarket.org" href="mailto:team@craftersmarket.org" />
            <Block icon={<MapPin />} title="Service area" value="Continental US — ships nationwide" />
            <Block icon={<Instagram />} title="Instagram" value="@craftersmarket" href="https://instagram.com/" />

            <div className="pt-6 border-t border-[#262626]">
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">
                Custom orders
              </div>
              <a href="/custom-order" className="btn-industrial btn-primary inline-flex" data-testid="contact-custom-link">
                Start a custom brief →
              </a>
            </div>
            <div>
              <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3] mb-2">
                Want to sell?
              </div>
              <a href="/apply" className="btn-industrial inline-flex border border-[#262626] hover:border-[#ff4500]" data-testid="contact-apply-link">
                Apply to the maker program →
              </a>
            </div>
          </div>

          <div className="border border-[#262626] p-6 md:p-10 bg-[#121212] h-fit">
            <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#ff4500] mb-3">
              ◆ Response time
            </div>
            <h3 className="font-display text-3xl mb-4 leading-tight">
              We reply to every email within 24 hours, weekdays.
            </h3>
            <p className="font-mono text-xs text-[#a3a3a3] leading-relaxed">
              Time-sensitive? Open the AI assistant in the lower-right corner — it can answer
              product questions, point you at the right page, and even capture a custom brief
              that lands directly in the team's inbox.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

const Block = ({ icon, title, value, href }) => {
  const inner = (
    <>
      <span className="text-[#ff4500]">{icon}</span>
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#a3a3a3]">{title}</div>
        <div className="font-display text-2xl text-[#e5e5e5] mt-1">{value}</div>
      </div>
    </>
  );
  return href ? (
    <a href={href} className="flex items-start gap-4 hover:text-[#ff4500] transition" data-testid={`contact-${title.toLowerCase()}`}>{inner}</a>
  ) : (
    <div className="flex items-start gap-4">{inner}</div>
  );
};
