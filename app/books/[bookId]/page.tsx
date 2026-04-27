"use client";

import { use } from "react";
import dynamic from "next/dynamic";

const Reader = dynamic(() => import("@/components/Reader"), { ssr: false });

export default function BookPage({
  params,
}: {
  params: Promise<{ bookId: string }>;
}) {
  const { bookId } = use(params);
  return <Reader bookId={bookId} />;
}
