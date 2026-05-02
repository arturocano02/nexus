"use client";

import { useUserStore } from "@/lib/stores/userStore";

interface AdvisorButtonProps {
  onClick: () => void;
  hasAlert?: boolean;
}

const MicIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 10a7 7 0 0014 0M12 19v3M8 22h8" />
  </svg>
);

export default function AdvisorButton({ onClick, hasAlert = false }: AdvisorButtonProps) {
  const { profile } = useUserStore();
  const advisorName = profile?.advisor_name || "Nexus";

  return (
    <div className="flex flex-col items-center gap-2" style={{ pointerEvents: "auto" }}>
      <div className="relative">
        {/* Pulsing circle */}
        <button
          onClick={onClick}
          className={hasAlert ? "advisor-pulse-alert" : "advisor-pulse"}
          style={{
            width: 72,
            height: 72,
            borderRadius: "50%",
            background: "radial-gradient(circle at 40% 35%, #8B6FDB, #6B4FBB)",
            border: "1px solid rgba(255,255,255,0.15)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
          aria-label={`Open ${advisorName}`}
        >
          <MicIcon />
        </button>

        {/* Notification dot */}
        {hasAlert && (
          <span
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#FFBF00",
              border: "2px solid #000033",
            }}
          />
        )}
      </div>

      {/* Advisor name label */}
      <span
        style={{
          fontSize: 11,
          color: "rgba(245,245,245,0.35)",
          letterSpacing: "0.06em",
          fontWeight: 500,
          userSelect: "none",
        }}
      >
        {advisorName}
      </span>
    </div>
  );
}
