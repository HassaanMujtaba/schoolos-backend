/** `app/layout/searchApi.ts`'s `GlobalSearchResult` — `type` is display-only, not a closed union on the frontend side either. */
export class SearchResultDto {
  id!: string;
  type!: string;
  label!: string;
  sublabel?: string;
  href!: string;
}
