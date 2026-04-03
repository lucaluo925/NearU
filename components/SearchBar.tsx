'use client'

import { Search, X } from 'lucide-react'
import { useRef } from 'react'

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export default function SearchBar({ value, onChange, placeholder = 'Search...' }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="relative flex items-center">
      <Search className="absolute left-3.5 w-4 h-4 text-[#9CA3AF] pointer-events-none" />
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white border border-[#E5E7EB] rounded-2xl pl-10 pr-9 py-2.5 text-[14px] text-[#111111] placeholder:text-[#9CA3AF] shadow-sm focus:outline-none focus:ring-2 focus:ring-[#111111]/10 focus:border-[#D1D5DB] transition-all"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute right-3 text-[#9CA3AF] hover:text-[#6B7280] transition-colors"
          aria-label="Clear search"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  )
}
