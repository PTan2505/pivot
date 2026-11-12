"use client";

import { Download, FileText, ImageOff } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { AssetDTO } from "@pivot/core/types";
import { Button } from "@/components/ui/button";
import { assetUrl } from "@/lib/api";

const Lottie = dynamic(() => import("lottie-react").then((m) => m.Lottie), { ssr: false });

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function LottiePreview({ asset }: { asset: AssetDTO }) {
  return <Lottie src={assetUrl(asset.id)} autoplay loop className="max-h-[70vh] w-full" />;
}

function FontPreview({ asset }: { asset: AssetDTO }) {
  const family = `asset-${asset.id}`;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const face = new FontFace(family, `url(${assetUrl(asset.id)})`);
    face
      .load()
      .then((f) => {
        document.fonts.add(f);
        setReady(true);
      })
      .catch(() => setReady(false));
  }, [asset.id, family]);
  return (
    <div className="space-y-3 p-8" style={{ fontFamily: ready ? family : undefined }}>
      <p className="text-5xl leading-tight tracking-tight">Aa Bb Cc 0123</p>
      <p className="text-2xl">The quick brown fox jumps over the lazy dog.</p>
      <p className="text-base text-muted-foreground">Tiếng Việt: Thư viện giao diện cá nhân — ăn, ở, đường, ữ.</p>
    </div>
  );
}

function TextPreview({ asset }: { asset: AssetDTO }) {
  const [text, setText] = useState("");
  useEffect(() => {
    fetch(assetUrl(asset.id))
      .then((r) => r.text())
      .then((t) => setText(t.slice(0, 50_000)));
  }, [asset.id]);
  return <pre className="max-h-[70vh] w-full overflow-auto p-4 font-mono text-xs whitespace-pre-wrap">{text}</pre>;
}

function FileCard({ asset }: { asset: AssetDTO }) {
  return (
    <div className="flex flex-col items-center gap-3 p-10 text-sm text-muted-foreground">
      <FileText className="size-8" aria-hidden />
      <span className="font-mono text-xs">{asset.fileName}</span>
      <Button asChild size="sm" variant="outline">
        <a href={assetUrl(asset.id, { download: true })}>
          <Download /> Download
        </a>
      </Button>
    </div>
  );
}

export function AssetPreview({ asset }: { asset: AssetDTO }) {
  if (asset.missing) {
    return (
      <div className="flex flex-col items-center gap-2 p-10 text-sm text-muted-foreground">
        <ImageOff className="size-6" aria-hidden />
        The file for “{asset.fileName}” is missing from the data folder.
      </div>
    );
  }
  switch (asset.kind) {
    case "image":
    case "svg":
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={assetUrl(asset.id)}
          alt={asset.notes || asset.fileName}
          className={asset.kind === "svg" ? "max-h-[70vh] w-auto p-8" : "h-auto w-full"}
        />
      );
    case "video":
      return <video src={assetUrl(asset.id)} controls loop playsInline className="max-h-[75vh] w-full bg-black" />;
    case "lottie":
      return asset.mimeType === "application/json" ? <LottiePreview asset={asset} /> : <FileCard asset={asset} />;
    case "font":
      return <FontPreview asset={asset} />;
    case "text":
      return <TextPreview asset={asset} />;
    default:
      return <FileCard asset={asset} />;
  }
}
