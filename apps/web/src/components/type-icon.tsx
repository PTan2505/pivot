import {
  Code,
  Compass,
  Globe,
  Image as ImageIcon,
  Library,
  ListChecks,
  MessageSquareText,
  Palette,
  Plug,
  ScrollText,
  Shapes,
  Sparkles,
  Wand,
  type LucideIcon,
} from "lucide-react";
import { TYPE_DEFS, type ResourceType } from "@pivot/core/types";

const ICONS: Record<string, LucideIcon> = {
  globe: Globe,
  library: Library,
  image: ImageIcon,
  shapes: Shapes,
  sparkles: Sparkles,
  palette: Palette,
  "message-square-text": MessageSquareText,
  wand: Wand,
  code: Code,
  "scroll-text": ScrollText,
  "list-checks": ListChecks,
  plug: Plug,
  compass: Compass,
};

export function TypeIcon({ type, className }: { type: ResourceType; className?: string }) {
  const Icon = ICONS[TYPE_DEFS[type].icon] ?? Globe;
  return <Icon className={className} aria-hidden />;
}
