-- Rattrapage des todos assignés à des ex-membres (cf. ticket 2f422033).
--
-- `removeMember` remet désormais `assignee_id` à NULL au départ d'un membre,
-- mais ce traitement est en ÉCRITURE : il ne vaut que pour les départs à
-- venir. Les membres déjà partis en production gardent donc leurs todos
-- assignés indéfiniment — et l'UI, ne résolvant plus leur nom dans la liste
-- des membres courants, affiche à la place les 8 premiers caractères de leur
-- UUID (`TodoListModal.tsx` : `memberNameById.get(id) ?? id.slice(0, 8)`).
--
-- C'est l'asymétrie du choix par pivot : les RSVP et les votes, filtrés à la
-- LECTURE, se corrigent d'eux-mêmes dès le déploiement pour tout l'historique.
-- L'assignation, traitée en écriture, non. D'où ce backfill, qui applique
-- rétroactivement exactement la règle que `removeMember` applique désormais.
--
-- Aucun changement de schéma : migration de données pure.
UPDATE "todo_items" ti
SET "assignee_id" = NULL,
    "updated_at" = now()
FROM "todo_lists" tl
WHERE tl."id" = ti."list_id"
  AND ti."assignee_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "group_members" gm
    WHERE gm."group_id" = tl."group_id"
      AND gm."user_id" = ti."assignee_id"
  );
