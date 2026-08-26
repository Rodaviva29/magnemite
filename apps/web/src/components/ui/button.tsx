import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium leading-5",
    "transition-[background-color,border-color,color,transform,box-shadow] duration-150 ease-out",
    "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 disabled:active:scale-100",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2",
    "focus-visible:ring-offset-background [&_svg]:size-4 [&_svg]:shrink-0",
    // A 16px icon overhangs a 14px label past the baseline, so centring it on
    // the line box reads low; half a pixel up puts it on the label's cap band.
    "[&_svg]:-translate-y-[0.5px]",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-sm ring-1 ring-inset ring-black/10 hover:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm ring-1 ring-inset ring-black/10 hover:bg-destructive/90",
        outline:
          "border border-border bg-card text-foreground shadow-sm hover:border-border-emphasis hover:bg-subtle",
        secondary: "bg-subtle text-foreground hover:bg-emphasis",
        ghost: "text-muted-foreground hover:bg-emphasis/60 hover:text-foreground",
        link: "text-foreground underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 rounded-lg px-3 text-[13px]",
        lg: "h-10 rounded-xl px-5",
        icon: "h-9 w-9 p-0 [&_svg]:translate-y-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
