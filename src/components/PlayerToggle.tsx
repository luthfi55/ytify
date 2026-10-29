import { playerHidden, setPlayerHidden } from "@config";

export default function PlayerToggle() {
  return (
    <i
      class={playerHidden() ? "ri-eye-line" : "ri-eye-off-line"}
      aria-label={playerHidden() ? "Show player" : "Hide player"}
      onclick={() => setPlayerHidden(!playerHidden())}
    ></i>
  );
}
