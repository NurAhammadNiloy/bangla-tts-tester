import type { Metadata } from "next";
import { Suspense } from "react";
import CreateWizard from "@/components/create/CreateWizard";

export const metadata: Metadata = { title: "Make a video · Golpo Studio" };

export default function CreatePage() {
  return (
    <main className="flex-1">
      <Suspense>
        <CreateWizard />
      </Suspense>
    </main>
  );
}
