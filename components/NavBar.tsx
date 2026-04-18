"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

// Inline SVG icons so we don't depend on an external icon library.
function HomeIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      className={`w-6 h-6 ${active ? "text-amber" : "text-secondary/70"}`}>
      <path d="M3 11.5 12 4l9 7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 10v9h14v-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function ArenaIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      className={`w-6 h-6 ${active ? "text-amber" : "text-secondary/70"}`}>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4v16" />
    </svg>
  );
}
function ProfileIcon({ active }: { active: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      className={`w-6 h-6 ${active ? "text-amber" : "text-secondary/70"}`}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c1.5-4 5-6 8-6s6.5 2 8 6" strokeLinecap="round" />
    </svg>
  );
}

const items = [
  { href: "/your-view", label: "View", Icon: HomeIcon },
  { href: "/arena", label: "Arena", Icon: ArenaIcon },
  { href: "/profile", label: "Profile", Icon: ProfileIcon },
];

export default function NavBar() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40">
      <div className="glass rounded-pill px-2 py-2 flex items-center gap-1 shadow-card">
        {items.map(({ href, label, Icon }) => {
          const active = pathname?.startsWith(href);
          return (
            <Link key={href} href={href} className="relative">
              <motion.div
                whileTap={{ scale: 0.92 }}
                className="flex items-center gap-2 px-4 py-2 rounded-pill"
              >
                <Icon active={!!active} />
                <span className={`text-sm font-medium hidden sm:block ${active ? "text-amber" : "text-secondary/70"}`}>
                  {label}
                </span>
                {active && (
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 -z-10 rounded-pill bg-amber/10 ring-1 ring-amber/40"
                    transition={{ type: "spring", stiffness: 400, damping: 32 }}
                  />
                )}
              </motion.div>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
