import NavBar from "@/components/NavBar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative w-full" style={{ minHeight: "100dvh" }}>
      {children}
      <NavBar />
    </div>
  );
}
