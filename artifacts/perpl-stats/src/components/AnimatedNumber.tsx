import { useEffect, useState } from "react";
import { motion, useAnimation, useSpring, useTransform } from "framer-motion";
import { cn } from "@/lib/utils";

interface AnimatedNumberProps {
  value: number;
  formatFn: (val: number) => string;
  className?: string;
}

export function AnimatedNumber({ value, formatFn, className }: AnimatedNumberProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const controls = useAnimation();
  
  useEffect(() => {
    if (value !== displayValue) {
      controls.start({
        color: ["hsl(var(--primary))", "hsl(var(--foreground))"],
        textShadow: [
          "0 0 8px hsl(var(--primary))",
          "0 0 0px transparent"
        ],
        transition: { duration: 0.5 }
      });
      setDisplayValue(value);
    }
  }, [value, displayValue, controls]);

  return (
    <motion.span animate={controls} className={cn("inline-block", className)}>
      {formatFn(value)}
    </motion.span>
  );
}
