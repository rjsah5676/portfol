import $ from "./jqueryGlobal";
import anime from "animejs";

let timeOut: ReturnType<typeof setTimeout> | undefined;

class Item {
  $element: JQuery<HTMLElement>;
  icon: string;
  fw: string;
  prev: Item | null = null;
  next: Item | null = null;
  isMoving = false;

  constructor(icon: string, fw: string, backgroundColor: string, message?: string) {
    if (icon === "list") {
      this.$element = $(document.createElement("div"));
    } else {
      this.$element = $(document.createElement("button"));
    }
    this.icon = icon;
    this.fw = fw;
    this.$element.addClass("item");
    this.$element.attr("id", icon);
    this.$element.css("background-color", backgroundColor);
    const i = document.createElement("i");
    let span: HTMLSpanElement | undefined;
    if (icon !== "list") {
      span = document.createElement("span");
      span.innerHTML = message ?? "";
      span.style.backgroundColor = backgroundColor;
    }
    $(i).addClass(fw + " fa-lg");
    this.$element.append(i);
    if (span) this.$element.append(span);
    const element = this;
    this.$element.on("mousemove", function () {
      clearTimeout(timeOut);
      timeOut = setTimeout(function () {
        if (element.next && element.isMoving) {
          element.next.moveTo(element);
        }
      }, 10);
    });
  }

  moveTo(item: Item) {
    anime({
      targets: this.$element[0],
      left: item.$element.css("left"),
      top: item.$element.css("top"),
      duration: 700,
      elasticity: 500,
    });
    if (this.next) {
      this.next.moveTo(item);
    }
  }

  updatePosition() {
    if (!this.prev) return;
    anime({
      targets: this.$element[0],
      left: this.prev.$element.css("left"),
      top: this.prev.$element.css("top"),
      duration: 80,
    });

    if (this.next) {
      this.next.updatePosition();
    }
  }
}

export default Item;
