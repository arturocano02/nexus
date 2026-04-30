"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Deprecated — simulation is no longer part of the product
export default function SimulatePage() {
  const router = useRouter();
  useEffect(() => { router.replace("/your-view"); }, [router]);
  return null;
}
