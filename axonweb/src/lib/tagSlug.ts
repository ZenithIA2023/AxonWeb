// Slug de tags personalizadas — compartilhado entre o editor de tags
// (Configurações) e a criação rápida no registro diário. Precisa ser o MESMO
// nos dois lugares: se divergir, a mesma palavra digitada em telas diferentes
// viraria duas tags distintas, quebrando a contagem por tag nas correlações.
export function slugifyTag(label: string): string {
  return (
    "custom_" +
    label
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "")
  );
}
