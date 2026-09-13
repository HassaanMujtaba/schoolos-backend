import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { LibrarySettingsService } from './library-settings.service';
import { LibrarySettingsDto } from './dto/settings.dto';
import { LibrarySettingsResponseDto } from './dto/library-response.dto';

/** `modules/library.md` "Open questions: Fine rate" — `GET/PATCH /library/settings`. */
@ApiTags('library')
@Controller('library/settings')
export class LibrarySettingsController {
  constructor(private readonly settings: LibrarySettingsService) {}

  @Get()
  @RequirePermission('library.read')
  get(): Promise<LibrarySettingsResponseDto> {
    return this.settings.get();
  }

  @Patch()
  @RequirePermission('library.manage-catalog')
  update(@Body() dto: LibrarySettingsDto): Promise<LibrarySettingsResponseDto> {
    return this.settings.update(dto);
  }
}
