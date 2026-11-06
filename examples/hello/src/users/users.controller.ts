import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@suku/core';
import { ApiKeyGuard, RequireApiKey } from '../common.js';
import { CreateUser, ListUsers } from './dto.js';
import { UsersService } from './users.service.js';

@Controller('users')
@UseGuards(ApiKeyGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query(ListUsers) query: ListUsers) {
    const all = this.users.findAll();
    const filtered = query.q
      ? all.filter((u) => u.name.toLowerCase().includes(query.q!.toLowerCase()))
      : all;
    return filtered.slice(0, query.limit);
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    const user = this.users.findOne(String(id));
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  @Post()
  @RequireApiKey()
  create(@Body(CreateUser) dto: CreateUser) {
    return this.users.create(dto.name);
  }

  @Delete(':id')
  @RequireApiKey()
  remove(@Param('id', ParseIntPipe) id: number) {
    this.users.findOne(String(id));
  }
}
