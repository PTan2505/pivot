"use client";

import { useParams } from "next/navigation";
import { Suspense } from "react";
import { ResourceDetail } from "@/components/resource-detail";

function ResourceFromParams() {
  const { id } = useParams<{ id: string }>();
  return <ResourceDetail id={id} />;
}

export default function ResourcePage() {
  return (
    <Suspense>
      <ResourceFromParams />
    </Suspense>
  );
}
