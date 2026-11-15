import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { MarketplaceService } from './marketplace.service.js';
import {
  CreateMarketplaceItemDto,
  InitPurchaseDto,
  QueryMarketplaceDto,
  VerifyPurchaseDto,
} from './dto/marketplace.dto.js';
import { UserId } from '../../common/decorators/user-id.decorator.js';

@Controller(['marketplace', 'api/marketplace'])
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Get('items')
  listItems(
    @Query() query: QueryMarketplaceDto,
    @UserId() userId: string,
  ) {
    return this.marketplaceService.listItems(userId, query);
  }

  @Get('items/:id')
  getItemById(
    @Param('id') id: string,
    @UserId() userId: string,
  ) {
    return this.marketplaceService.getItemById(id, userId);
  }

  @Post('items')
  createItem(
    @Body() dto: CreateMarketplaceItemDto & { sellerId?: string },
    @UserId('sellerId') sellerId: string,
  ) {
    return this.marketplaceService.createItem(sellerId, dto);
  }

  @Post('items/:id/purchase/init')
  initializePurchase(
    @Param('id') id: string,
    @Body() _dto: Partial<InitPurchaseDto> & { userId?: string },
    @UserId() buyerId: string,
  ) {
    return this.marketplaceService.initializePurchase(buyerId, id);
  }

  @Post('items/:id/purchase/verify')
  verifyPurchase(
    @Param('id') id: string,
    @Body() dto: VerifyPurchaseDto & { userId?: string },
    @UserId() buyerId: string,
  ) {
    return this.marketplaceService.verifyPurchase(buyerId, id, dto.paystackReference);
  }

  @Get('items/:id/reader-access')
  getReaderAccess(
    @Param('id') id: string,
    @UserId() userId: string,
  ) {
    return this.marketplaceService.getReaderAccess(userId, id);
  }

  @Post('items/:id/download')
  recordDownload(@Param('id') id: string) {
    return this.marketplaceService.recordDownload(id);
  }

  @Get('lecturer/royalties')
  getLecturerRoyalties(@UserId() userId: string) {
    return this.marketplaceService.getLecturerRoyaltiesSummary(userId);
  }

  @Post('lecturer/nuban')
  configureLecturerNuban(
    @UserId() userId: string,
    @Body()
    dto: {
      bankCode: string;
      bankName: string;
      accountNumber: string;
      businessName?: string;
      percentageCharge?: number;
    },
  ) {
    return this.marketplaceService.configureLecturerRoyaltyNuban(userId, dto);
  }
}
