(function () {
  var links = Array.prototype.slice.call(document.querySelectorAll("a.preservation-original-image"));

  if (!links.length) {
    return;
  }

  var currentIndex = 0;
  var lightbox = document.createElement("div");
  lightbox.className = "preservation-lightbox";
  lightbox.setAttribute("role", "dialog");
  lightbox.setAttribute("aria-modal", "true");
  lightbox.setAttribute("aria-label", "Full-resolution image viewer");
  lightbox.innerHTML = [
    '<button class="preservation-lightbox__button preservation-lightbox__close" type="button" aria-label="Close">&times;</button>',
    '<button class="preservation-lightbox__button preservation-lightbox__previous" type="button" aria-label="Previous image">&#8249;</button>',
    '<img class="preservation-lightbox__image" alt="">',
    '<button class="preservation-lightbox__button preservation-lightbox__next" type="button" aria-label="Next image">&#8250;</button>',
    '<div class="preservation-lightbox__footer">',
    '<div class="preservation-lightbox__caption"></div>',
    '<a class="preservation-lightbox__open-original" target="_blank" rel="noopener">Open original</a>',
    '</div>'
  ].join("");

  document.body.appendChild(lightbox);

  var image = lightbox.querySelector(".preservation-lightbox__image");
  var caption = lightbox.querySelector(".preservation-lightbox__caption");
  var original = lightbox.querySelector(".preservation-lightbox__open-original");
  var closeButton = lightbox.querySelector(".preservation-lightbox__close");
  var previousButton = lightbox.querySelector(".preservation-lightbox__previous");
  var nextButton = lightbox.querySelector(".preservation-lightbox__next");

  function captionFor(link) {
    var figure = link.closest("figure");
    var figcaption = figure && figure.querySelector("figcaption");
    return figcaption ? figcaption.textContent.trim() : "";
  }

  function show(index) {
    currentIndex = (index + links.length) % links.length;
    var link = links[currentIndex];
    var img = link.querySelector("img");
    var href = link.getAttribute("href");

    image.removeAttribute("src");
    image.alt = img ? img.getAttribute("alt") || "" : "";
    image.src = href;
    original.href = href;
    caption.textContent = captionFor(link);
    caption.hidden = !caption.textContent;
    lightbox.classList.add("is-open");
    document.documentElement.classList.add("preservation-lightbox-open");
    closeButton.focus();
  }

  function close() {
    lightbox.classList.remove("is-open");
    document.documentElement.classList.remove("preservation-lightbox-open");
    image.removeAttribute("src");
    links[currentIndex].focus();
  }

  function move(step) {
    show(currentIndex + step);
  }

  links.forEach(function (link, index) {
    link.addEventListener("click", function (event) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      event.preventDefault();
      show(index);
    });
  });

  closeButton.addEventListener("click", close);
  previousButton.addEventListener("click", function () { move(-1); });
  nextButton.addEventListener("click", function () { move(1); });

  lightbox.addEventListener("click", function (event) {
    if (event.target === lightbox) {
      close();
    }
  });

  document.addEventListener("keydown", function (event) {
    if (!lightbox.classList.contains("is-open")) {
      return;
    }

    if (event.key === "Escape") {
      close();
    } else if (event.key === "ArrowLeft") {
      move(-1);
    } else if (event.key === "ArrowRight") {
      move(1);
    }
  });
}());
