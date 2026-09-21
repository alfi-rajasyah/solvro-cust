import markOnDark from "@/assets/brand/elitery-mark-on-dark.png";
import markOnLight from "@/assets/brand/elitery-mark-on-light.png";

interface BrandMarkProps {
  /** Sizing/utility classes applied to whichever mark is shown (e.g. "h-8 w-8"). */
  className?: string;
}

// Theme-adaptive Elitery "e" mark. Renders both PNGs and toggles them with the
// `dark:` variant, so the mark always matches the surface it sits on: the
// dark-ink mark on light surfaces, the light-ink mark on dark surfaces. It keys
// off the nearest `.dark` context — so it's correct on the always-dark login /
// sidebar (which carry their own `dark` class) as well as any light app chrome.
export function BrandMark({ className = "h-8 w-8" }: BrandMarkProps) {
  return (
    <>
      <img
        src={markOnLight}
        alt="Elitery"
        className={`object-contain dark:hidden ${className}`}
      />
      <img
        src={markOnDark}
        alt="Elitery"
        className={`hidden object-contain dark:block ${className}`}
      />
    </>
  );
}
