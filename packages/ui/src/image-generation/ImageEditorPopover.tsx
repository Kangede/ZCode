import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { Button } from "@/components/ui/button.js";

export function ImageEditorPopover({
  open,
  onOpenChange,
  title,
  trigger,
  children,
  side = "top",
  testId,
  zh,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  trigger: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom";
  testId: string;
  zh: boolean;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        side={side}
        align="start"
        sideOffset={10}
        collisionPadding={12}
        // 保存时控件会暂时禁用；面板只由关闭按钮、外部点击或 Escape 收起。
        onFocusOutside={(event) => event.preventDefault()}
        className="max-h-[min(70dvh,600px)] w-[min(24rem,calc(100vw-24px))] gap-4 overflow-y-auto p-4"
        data-testid={testId}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-ui-base font-medium">{title}</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon-md"
            aria-label={zh ? "关闭面板" : "Close panel"}
            onClick={() => onOpenChange(false)}
          >
            <X />
          </Button>
        </div>
        {children}
      </PopoverContent>
    </Popover>
  );
}
