import Image from "next/image";

/**
 * The official AAU lockup. Two variants ship: the RGB mark for light
 * backgrounds and the all-white mark for the deep blue band. Both are the
 * supplied English ("UK") artwork — the Danish files are in /public/brand if
 * the portal is ever switched to Danish.
 *
 * The logo is never recoloured, stretched, or set on a background that isn't
 * either near-white or AAU blue, which is what the university's guidelines
 * require of it.
 */

const INTRINSIC = { width: 416, height: 110 };

export function AauLogo({
  variant = "rgb",
  height = 32,
  className,
  priority = false,
}: {
  variant?: "rgb" | "white";
  height?: number;
  className?: string;
  priority?: boolean;
}) {
  const src =
    variant === "white"
      ? "/brand/aau-left-white-uk.png"
      : "/brand/aau-left-rgb-uk.png";

  return (
    <Image
      src={src}
      alt="Aalborg University"
      width={Math.round((INTRINSIC.width / INTRINSIC.height) * height)}
      height={height}
      className={className}
      priority={priority}
    />
  );
}
