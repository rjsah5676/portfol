/** 스피커 아이콘 (배경음 켜짐: 소리 물결 / 꺼짐: X) */
export default function SpeakerIcon({ muted, className }: { muted: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" />
      {muted ? (
        <path d="m16 9 6 6m0-6-6 6" />
      ) : (
        <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />
      )}
    </svg>
  );
}
