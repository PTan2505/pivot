"use client";

import { useParams } from "next/navigation";
import { Suspense } from "react";
import { DesignSessionView } from "@/components/design-session";

function SessionFromParams() {
  const { id } = useParams<{ id: string }>();
  return <DesignSessionView id={id} />;
}

export default function DesignSessionPage() {
  return (
    <Suspense>
      <SessionFromParams />
    </Suspense>
  );
}
