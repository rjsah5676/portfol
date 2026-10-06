/// <reference types="jqueryui" />
import $ from "./jqueryGlobal";
import anime from "animejs";
import "jquery-ui-dist/jquery-ui";
import type Item from "./Item";

class Menu {
  $element: JQuery<HTMLElement>;
  size = 0;
  first: Item | null = null;
  last: Item | null = null;
  timeOut: ReturnType<typeof setTimeout> | null = null;
  hasMoved = false;
  status: "open" | "closed" = "closed";

  constructor(menu: string) {
    this.$element = $(menu);
  }

  add(item: Item) {
    const menu = this;
    if (this.first === null) {
      this.first = item;
      this.last = item;
      this.first.$element.on("mouseup", function () {
        if (menu.first!.isMoving) {
          menu.first!.isMoving = false;
        } else {
          menu.click();
        }
      });
      // 원래 옵션 객체 3개를 따로 넘기고 있었음(jQuery UI가 내부에서 병합) -> 하나로 합침
      item.$element.draggable({
        start: function () {
          menu.close();
          item.isMoving = true;
        },
        drag: function () {
          if (item.next) {
            item.next.updatePosition();
          }
        },
        stop: function () {
          item.isMoving = false;
          item.next?.moveTo(item);
        },
      });
    } else {
      this.last!.next = item;
      item.prev = this.last;
      this.last = item;
    }
    this.$element.after(item.$element);
  }

  open() {
    if (!this.first) return;
    this.status = "open";
    this.first.$element.addClass("open");
    let current = this.first.next;
    let iterator = 1;
    const head = this.first;
    const sens = parseInt(head.$element.css("left"), 10) + 500 < 0 ? 1 : -1;
    // 모바일에서 버튼이 작아지므로 간격도 버튼 크기에 비례 (70px -> 50px)
    const step = Math.round((head.$element.outerWidth() ?? 70) * (50 / 70));
    while (current != null) {
      anime({
        targets: current.$element[0],
        left: parseInt(head.$element.css("left"), 10) + sens * (iterator * step),
        top: head.$element.css("top"),
        duration: 500,
      });
      iterator++;
      current = current.next;
    }
  }

  close() {
    if (!this.first) return;
    this.status = "closed";
    this.first.$element.removeClass("open");
    let current = this.first.next;
    const head = this.first;
    while (current != null) {
      anime({
        targets: current.$element[0],
        left: head.$element.css("left"),
        top: head.$element.css("top"),
        duration: 500,
      });
      current = current.next;
    }
  }

  click() {
    if (this.status === "closed") {
      this.open();
    } else {
      this.close();
    }
  }
}

export default Menu;
