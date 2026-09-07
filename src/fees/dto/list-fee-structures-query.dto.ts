import { ListQueryDto } from '../../common/pagination/list-query.dto';

/**
 * `GET /fees/structures?page=&pageSize=&search=` — `search` (inherited from `ListQueryDto`)
 * matches on `FeeStructure.name`, same as every other `ListQueryDto` consumer's free-text filter.
 */
export class ListFeeStructuresQueryDto extends ListQueryDto {}
