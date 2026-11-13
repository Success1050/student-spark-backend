export class PaginationDto {
  page?: number = 1;
  limit?: number = 20;
  search?: string;
  sortBy?: 'newest' | 'oldest' | 'alphabetical' = 'newest';
}
