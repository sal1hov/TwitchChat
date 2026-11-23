
const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector(".navigation");

// Мобильное меню
if (menuButton && navigation) {
  menuButton.addEventListener("click", () => {
    const isOpen = menuButton.getAttribute("aria-expanded") === "true";

    menuButton.setAttribute("aria-expanded", String(!isOpen));
    navigation.classList.toggle("is-open", !isOpen);
  });

  navigation.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      menuButton.setAttribute("aria-expanded", "false");
      navigation.classList.remove("is-open");
    });
  });
}

// Автоматическое обновление года
const year = document.querySelector("#year");

if (year) {
  year.textContent = new Date().getFullYear();
}

// Эффект света, следующего за курсором
const featureCards = document.querySelectorAll(".feature-card");

if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
  featureCards.forEach((card) => {
    card.addEventListener("pointermove", (event) => {
      const rect = card.getBoundingClientRect();

      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      card.style.setProperty("--mouse-x", `${x}px`);
      card.style.setProperty("--mouse-y", `${y}px`);
    });

    card.addEventListener("pointerleave", () => {
      card.style.setProperty("--mouse-x", "50%");
      card.style.setProperty("--mouse-y", "50%");
    });
  });
}
