// Shared by the editor and the server; fixed approved text is never an input.
export function templateSlots(components = []) {
  const slots = [];
  for (const component of components) {
    const kind = component.type?.toUpperCase();
    if (["HEADER", "BODY"].includes(kind)) {
      if (
        kind === "HEADER" &&
        ["IMAGE", "VIDEO", "DOCUMENT"].includes(component.format)
      ) {
        slots.push({
          component: "header",
          key: "media",
          type: component.format.toLowerCase(),
        });
      } else if (!component.format || component.format === "TEXT") {
        for (const key of [
          ...new Set(
            [...String(component.text || "").matchAll(/\{\{([\w]+)\}\}/g)].map(
              (m) => m[1],
            ),
          ),
        ])
          slots.push({ component: kind.toLowerCase(), key, type: "text" });
      } else
        throw Error(
          "Formato de cabeçalho ainda não suportado: " + component.format,
        );
    } else if (kind === "BUTTONS") {
      component.buttons?.forEach((button, index) => {
        if (!["URL", "PHONE_NUMBER", "QUICK_REPLY"].includes(button.type))
          throw Error("Tipo de botão ainda não suportado: " + button.type);
        for (const key of [
          ...new Set(
            [...String(button.url || "").matchAll(/\{\{([\w]+)\}\}/g)].map(
              (m) => m[1],
            ),
          ),
        ])
          slots.push({
            component: "button",
            index: String(index),
            sub_type: "url",
            key,
            type: "text",
          });
      });
    } else if (kind !== "FOOTER")
      throw Error("Componente ainda não suportado: " + kind);
  }
  return slots;
}
export const slotId = (slot) =>
  [slot.component, slot.index ?? "", slot.key].join(":");
