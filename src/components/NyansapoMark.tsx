import nyansapoImage from "@/assets/Nyansapo.jpg";

type NyansapoMarkProps = {
  className?: string;
  variant?: "small" | "large";
};

export function NyansapoMark({ className = "", variant = "small" }: NyansapoMarkProps) {
  const size = variant === "large" ? 140 : 34;
  const height = variant === "large" ? 167 : 41;

  return (
    <img
      src={nyansapoImage}
      alt="Nyansapo"
      width={size}
      height={height}
      className={className}
    />
  );
}
