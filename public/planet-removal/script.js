"use strict";

// Keep support answers reachable when a direct link targets a closed answer.
function revealLinkedAnswer() {
  if (!window.location.hash) return;
  const answer = document.getElementById(window.location.hash.slice(1));
  if (answer instanceof HTMLDetailsElement) answer.open = true;
}
revealLinkedAnswer();
window.addEventListener("hashchange", revealLinkedAnswer);
