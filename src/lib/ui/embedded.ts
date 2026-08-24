'use client'
/**
 * Embedded context — true when a department page is rendered INSIDE the Growth hub (as a tab) rather than
 * as its own route. Departments read this to drop their big page header + back-link and tighten padding, so
 * the hub reads as one cohesive designed surface instead of a page bolted into another page.
 */
import { createContext, useContext } from 'react'

export const EmbeddedContext = createContext(false)
export const useEmbedded = () => useContext(EmbeddedContext)
